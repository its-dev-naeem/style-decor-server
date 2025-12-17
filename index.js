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

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      // console.log(paymentInfo)
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
          serviceId: paymentInfo?.service?.id,
          customer: paymentInfo?.user?.name,
          city: paymentInfo?.location || "Dhaka",
        },
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/bookings`,
      });
      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);
      const service = await BookingCollection.findOne({
        "service.id": session.metadata.serviceId,
      });
      console.log(service);
      const bookings = await paymentCollection.findOne({
        transactionId: session.payment_intent,
      });
      // console.log(bookings);
      if (session.status === "complete" && service && !bookings) {
        // save order data in db
        const paymentData = {
          serviceId: session.metadata.serviceId,
          transactionId: session.payment_intent,
          customer: session.metadata.customer,
          status: "paid",
          userName: service.user.name,
          userEmail: service.user.email,
          providerName: service.provider.name,
          providerEmail: service.provider.email,
          serviceName: service.service.name,
          category: service.service.caterory,
          unit: service.service.unit,
          image: service.service.image,
          quantity: 1,
          price: session.amount_total / 100,
          location: session.metadata.city,
        };
        // console.log(paymentData);
        const result = await paymentCollection.insertOne(paymentData);
        await BookingCollection.updateOne(
          {
            "service.id": session.metadata.serviceId,
          },
          { $set: { "service.status": "Paid" } }
        );

        return res.send({
          transactionId: session.payment_intent,
          orderId: result.insertedId,
        });
        // console.log(result);
      }
    });

  

    //user booking data post
    app.post("/booking-data", async (req, res) => {
      const bookingData = req.body;
      // console.log(bookingData);
      const result = await BookingCollection.insertOne(bookingData);
      res.send(result);
    });
    app.get("/booking-data", async (req, res) => {
      const result = await BookingCollection.find().toArray();
      res.send(result);
    });

    //user booking data api
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
