require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const decoded = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  "base64"
).toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Hello World!");
});

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    // console.log(" No or invalid Authorization header:", authHeader);
    return res.status(401).send({ message: "unauthorized access - no token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const userInfo = await admin.auth().verifyIdToken(token);
    // console.log("Token verified for:", userInfo.email);
    req.user = userInfo;
    next();
  } catch (error) {
    // console.error("Token verification failed:", error.message);
    return res
      .status(401)
      .send({ message: "unauthorized access - invalid token" });
  }
};

const uri = process.env.MONGO_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const userDB = client.db("usersJobsDb");
    const jobCollection = userDB.collection("jobs");
    const acceptedJobCollection = userDB.collection("acceptedJob");
    const reviewsCollection = userDB.collection("reviews");
    //-----------------########################################
    app.get("/jobs", async (req, res) => {
      try {
        const { page, limit, search, category } = req.query;

        // build mongo query
        const q = {};
        if (category) q.category = category;
        if (search) {
          const term = search.trim();
          q.$or = [
            { title: { $regex: term, $options: "i" } },
            { summary: { $regex: term, $options: "i" } },
            { category: { $regex: term, $options: "i" } },
          ];
        }

        if (page && limit) {
          const p = Math.max(1, parseInt(page, 10) || 1);
          const l = Math.max(1, parseInt(limit, 10) || 10);
          const cursor = jobCollection.find(q).sort({ postedDate: -1 });
          const total = await cursor.count();
          const data = await cursor
            .skip((p - 1) * l)
            .limit(l)
            .toArray();
          return res.send({ data, total });
        }

        // default: return all jobs array (used by charts / other callers)
        const jobs = await jobCollection
          .find(q)
          .sort({ postedDate: -1 })
          .toArray();
        res.send(jobs);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch jobs" });
      }
    });

    app.post("/jobs", async (req, res) => {
      const newJob = req.body;
      try {
        const result = await jobCollection.insertOne(newJob);
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to create job" });
      }
    });

    app.get("/jobs/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const query = { _id: new ObjectId(id) };
        const result = await jobCollection.findOne(query);
        res.send(result);
      } catch {
        res.status(400).send({ message: "Invalid job id" });
      }
    });

    app.patch("/jobs/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      try {
        const updateDoc = { $set: updatedData };
        const query = { _id: new ObjectId(id) };
        const result = await jobCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch {
        res.status(400).send({ message: "Failed to update job" });
      }
    });

    app.delete("/jobs/:id", async (req, res) => {
      const userId = req.params.id;
      try {
        const query = { _id: new ObjectId(userId) };
        const result = await jobCollection.deleteOne(query);
        res.send(result);
      } catch {
        res.status(400).send({ message: "Failed to delete job" });
      }
    });

    // --- Accepted jobs (existing)
    app.get("/acceptedJob", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      const query = { email };
      const result = await acceptedJobCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/acceptedJob", async (req, res) => {
      const newAccept = req.body;
      try {
        const result = await acceptedJobCollection.insertOne(newAccept);
        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to accept job" });
      }
    });

    app.delete("/acceptedJob/:id", async (req, res) => {
      const userId = req.params.id;
      try {
        const query = { _id: new ObjectId(userId) };
        const result = await acceptedJobCollection.deleteOne(query);
        res.send(result);
      } catch {
        res.status(400).send({ message: "Failed to delete accepted job" });
      }
    });

    // --- Reviews: GET by jobId, POST (requires auth), PUT (owner only), DELETE (owner only)
    // GET /reviews?jobId=<id>
    app.get("/reviews", async (req, res) => {
      try {
        const { jobId, userEmail } = req.query;
        const q = {};
        if (jobId) q.jobId = jobId;
        if (userEmail) q.userEmail = userEmail;
        const items = await reviewsCollection
          .find(q)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(items);
      } catch {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    // Create a review - authenticated
    app.post("/reviews", verifyFirebaseToken, async (req, res) => {
      try {
        const body = req.body || {};
        // enforce userEmail matches token to prevent spoofing
        if (!body.userEmail || body.userEmail !== req.user.email) {
          return res.status(403).send({ message: "user mismatch" });
        }
        const review = {
          jobId: body.jobId,
          userEmail: body.userEmail,
          name: body.name || req.user.name || req.user.email,
          rating: Number(body.rating) || 5,
          text: body.text || "",
          createdAt: new Date().toISOString(),
        };
        const result = await reviewsCollection.insertOne(review);
        res.send({ insertedId: result.insertedId });
      } catch {
        res.status(500).send({ message: "Failed to submit review" });
      }
    });

    // Update a review - only owner
    app.put("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      try {
        const existing = await reviewsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!existing)
          return res.status(404).send({ message: "Review not found" });
        if (existing.userEmail !== req.user.email)
          return res.status(403).send({ message: "Forbidden" });

        const updateDoc = {
          $set: {
            text: req.body.text ?? existing.text,
            rating: Number(req.body.rating ?? existing.rating),
            updatedAt: new Date().toISOString(),
          },
        };
        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );
        res.send(result);
      } catch {
        res.status(400).send({ message: "Failed to update review" });
      }
    });

    // Delete a review - only owner
    app.delete("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      try {
        const existing = await reviewsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!existing)
          return res.status(404).send({ message: "Review not found" });
        if (existing.userEmail !== req.user.email)
          return res.status(403).send({ message: "Forbidden" });

        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch {
        res.status(400).send({ message: "Failed to delete review" });
      }
    });

    //  lightweight stats endpoint (jobs count by category)
    app.get("/stats/jobs-by-category", async (req, res) => {
      try {
        const pipeline = [
          { $group: { _id: "$category", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ];
        const agg = await jobCollection.aggregate(pipeline).toArray();
        res.send(
          agg.map((a) => ({
            category: a._id || "Uncategorized",
            count: a.count,
          }))
        );
      } catch {
        res.status(500).send({ message: "Failed to fetch stats" });
      }
    });

    ///################################-------------------------
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
}
module.exports = app;
