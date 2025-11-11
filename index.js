require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./firebaseAdminSDK.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Hello World!");
});

const verifyFirebaseToken = async (req, res, next) => {
  console.log(req.headers);

  if (req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  ///////////////verify token /////////////////////////////////////

  try {
    const userInfo = await admin.auth().verifyIdToken(token);
    console.log("token validation", userInfo);

    next();
  } catch {
    return res.status(401).send({ message: "unauthorized access" });
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
    await client.connect();
    const userDB = client.db("usersJobsDb");
    const jobCollection = userDB.collection("jobs");
    const acceptedJobCollection = userDB.collection("acceptedJob");

    //-----------------########################################
    app.get("/jobs", async (req, res) => {
      const jobs = await jobCollection
        .find()
        .sort({ postedDate: -1 })
        .toArray();
      res.send(jobs);
    });

    app.post("/jobs", async (req, res) => {
      const newJob = req.body;
      //   console.log(newJob);
      const result = await jobCollection.insertOne(newJob);
      res.send(result);
    });

    app.get("/jobs/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      //   console.log(query);

      const result = await jobCollection.findOne(query);
      res.send(result);
    });

    app.patch("/jobs/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      //   console.log(updatedData);
      const updateDoc = {
        $set: updatedData,
      };

      const query = { _id: new ObjectId(id) };
      const result = await jobCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.delete("/jobs/:id", async (req, res) => {
      const userId = req.params.id;
      const query = { _id: new ObjectId(userId) };
      const result = await jobCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/acceptedJob", verifyFirebaseToken, async (req, res) => {
      // console.log(req);

      const email = req.query.email;
      //   console.log(email);
      const query = { email };
      const result = await acceptedJobCollection.find(query).toArray();
      res.send(result);
    });
    app.post("/acceptedJob", async (req, res) => {
      const newAccept = req.body;
      const result = await acceptedJobCollection.insertOne(newAccept);
      res.send(result);
    });
    app.delete("/acceptedJob/:id", async (req, res) => {
      const userId = req.params.id;
      const query = { _id: new ObjectId(userId) };
      const result = await acceptedJobCollection.deleteOne(query);
      res.send(result);
    });

    ///################################-------------------------
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
