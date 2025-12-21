require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const { ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
// const verifyJWT = async (req, res, next) => {
//   const token = req?.headers?.authorization?.split(' ')[1]
//   console.log(token)
//   if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
//   try {
//     const decoded = await admin.auth().verifyIdToken(token)
//     req.tokenEmail = decoded.email
//     console.log(decoded)
//     next()
//   } catch (err) {
//     console.log(err)
//     return res.status(401).send({ message: 'Unauthorized Access!', err })
//   }
// }

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("StyleDecorDB");
    const serviceCollection = db.collection("Services");
    const BookingCollection = db.collection("Bookings");
    const paymentCollection = db.collection("Payments");
    const usersCollection = db.collection("Users");

    //Post one service data
    app.post("/services", async (req, res) => {
      const servicesData = req.body;
      console.log(servicesData);
      const result = await serviceCollection.insertOne(servicesData);
      res.send(result);
    });
    // Get all services data
    app.get("/services", async (req, res) => {
      const result = await serviceCollection.find().toArray();
      res.send(result);
    });

    //get one service data
    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const result = await serviceCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Update service by id
    app.put("/services/:id", async (req, res) => {
      const result = await serviceCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
      );
      res.json(result);
    });

    // delete service by id
    app.delete("/services/:id", async (req, res) => {
      const id = req.params.id;
      const result = await serviceCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    //checkout payment
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo._id);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              product_data: {
                name: paymentInfo.service.name,
                images: [paymentInfo?.service?.image],
                description: paymentInfo?.service?.description
                  ? paymentInfo?.service?.description
                  : "No description available...!",
              },
              unit_amount: paymentInfo.totalPrice * 100,
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo?.user?.email,
        mode: "payment",
        metadata: {
          serviceId: paymentInfo?.service.id,
          payId: paymentInfo?._id,
          customer: paymentInfo?.user?.name,
          city: paymentInfo?.location || "Dhaka",
        },
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/bookings`,
      });
      res.send({ url: session.url });
    });

    //payment success
    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);
      const service = await BookingCollection.findOne({
        "service.id": session.metadata.serviceId,
      });
      // console.log(service);
      const bookings = await paymentCollection.findOne({
        transactionId: session.payment_intent,
      });
      console.log(session.metadata.serviceId);

      if (session.status === "complete" && service && !bookings) {
        // save order data in db
        const paymentData = {
          serviceId: session.metadata.serviceId,
          transactionId: session.payment_intent,
          customer: session.metadata.customer,
          status: "paid",
          userName: session.metadata.customer,
          userEmail: session.customer_email,
          providerName: service.provider.name,
          providerEmail: service.provider.email,
          serviceName: service.service.name,
          category: service.service.caterory,
          unit: service.service.unit,
          image: service.service.image,
          quantity: 1,
          price: session.amount_total / 100,
          location: session.metadata.city,
          decoretorName: null,
          decoretorEmail: null,
        };
        // console.log(paymentData);
        const result = await paymentCollection.insertOne(paymentData);
        await BookingCollection.updateOne(
          { _id: new ObjectId(session.metadata.payId) },
          { $set: { "service.status": "Paid" } }
        );

        return res.send({
          transactionId: session.payment_intent,
          orderId: result.insertedId,
        });
        // console.log(result);
      }
    });

    // get all payments 
    app.get("/payments", async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });
    // get all payments for a customer by email
    app.get("/my-payments/:email", async (req, res) => {
      const email = req.params.email;
      const result = await paymentCollection
        .find({ userEmail: email })
        .toArray();
      res.send(result);
      // console.log(email);
    });

    //user booking data post
    app.post("/booking-data", async (req, res) => {
      const bookingData = req.body;
      // console.log(bookingData);
      const result = await BookingCollection.insertOne(bookingData);
      res.send(result);
    });
    //get user booking data all for admin
    app.get("/booking-data", async (req, res) => {
      const result = await BookingCollection.find().toArray();
      res.send(result);
    });

    //user booking data for user
    app.get("/booking-data/:id", async (req, res) => {
      try {
        const uid = req.params.id;
        const result = await BookingCollection.find({ uid: uid }).toArray();
        res.status(200).send(result);
      } catch (error) {
        console.log("DB Error:", error);
        res.status(500).json({ error: "Server error" });
      }
    });
    // user booked data delete
    app.delete("/booking-data/:id", async (req, res) => {
      try {
        const uid = req.params.id;
        // console.log(uid);
        const result = await BookingCollection.deleteOne({
          _id: new ObjectId(uid),
        });
        res.send(result);
      } catch (error) {
        console.log("DB Delete Error:", error);
      }
    });

    //create a users account
    app.post("/user", async (req, res) => {
      try {
        const { role, ...rest } = req.body;

        const userData = {
          ...rest,
          last_loggedIn: new Date().toISOString(),
        };

        const result = await usersCollection.updateOne(
          { email: userData.email },
          {
            $set: userData, 
            $setOnInsert: {
              created_at: new Date().toISOString(),
              role: "user", 
            },
          },
          { upsert: true }
        );

        res.send(result);
      } catch (error) {
        console.error("Error in /user:", error);
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    // get a user's role by email
    app.get("/user/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    //get all users
    app.get("/all-users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    //update roll by id
    app.put("/update-role/:id", async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      console.log(id, role);
      res.send(result);
    });

    //Get all decorator 
    app.get("/decorators", async(req, res) =>{
      const result = await usersCollection.find({role: 'decorator'}).toArray()
      res.send(result)
    })
    ////////////////////////
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server...");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
