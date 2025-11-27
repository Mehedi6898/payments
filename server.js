import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// dirname fix for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Orders + download token storage
const orders = {};
const downloadTokens = {};

// ---------------- PRODUCT DATABASE ----------------
const PRODUCTS = {
  "1xbet-crash": {
    name: "1xbet Crash Hack",
    priceUsd: 100,
    fileName: "1xbet-crash.zip",
  },
  "1win-aviator-spribe": {
    name: "1Win Aviator Hack",
    priceUsd: 100,
    fileName: "1win-aviator-spribe.zip",
  },
  luckyjet: {
    name: "LuckyJet Hack",
    priceUsd: 100,
    fileName: "luckyjet.zip",
  },
  "mostbet-aviator-spribe": {
    name: "Mostbet Aviator Hack",
    priceUsd: 100,
    fileName: "mostbet-aviator-spribe.zip",
  },
  "apple-of-fortune": {
    name: "Apple Of Fortune Hack",
    priceUsd: 100,
    fileName: "apple-of-fortune.zip",
  },
  thimbles: {
    name: "Thimbles Hack",
    priceUsd: 100,
    fileName: "thimbles.zip",
  },
  "wild-west-gold": {
    name: "Wild West Gold Hack",
    priceUsd: 100,
    fileName: "wild-west-gold.zip",
  },
  "higher-vs-lower": {
    name: "Higher VS Lower Hack",
    priceUsd: 100,
    fileName: "higher-vs-lower.zip",
  },
  "dragons-gold": {
    name: "Dragons Gold Hack",
    priceUsd: 100,
    fileName: "dragons-gold.zip",
  },
};

// ---------------- Utility ----------------
function getFilePath(fileName) {
  return path.join(__dirname, "files", fileName);
}

// ---------------- CREATE PAYMENT ----------------
app.post("/api/create-payment", async (req, res) => {
  try {
    const { productId } = req.body;
    const product = PRODUCTS[productId];

    if (!product) {
      return res.status(400).json({ error: "Unknown productId" });
    }

    const orderId = `${productId}-${Date.now()}`;

    const payload = {
      price_amount: product.priceUsd,
      price_currency: "usd",
      pay_currency: "trc20usdt", // FIXED — CORRECT CURRENCY CODE
      order_id: orderId,
      order_description: product.name,
      ipn_callback_url: `${process.env.BACKEND_URL}/api/ipn`,
      success_url: process.env.PAYMENT_SUCCESS_URL,
      cancel_url: process.env.PAYMENT_CANCEL_URL,
    };

    console.log("Sending create payment payload:", payload);

    const response = await axios.post(
      "https://api.nowpayments.io/v1/payment",
      payload,
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const payment = response.data;

    console.log("NOWPayments response:", payment);

    // Save minimal order tracking
    orders[payment.payment_id] = {
      productId,
      status: payment.payment_status,
      downloadToken: null,
    };

    return res.json({
      paymentId: payment.payment_id,
      paymentStatus: payment.payment_status,
      paymentUrl: payment.invoice_url || payment.payment_url,
      payAddress: payment.pay_address,
      payAmount: payment.pay_amount,
      currency: payment.pay_currency,
    });
  } catch (err) {
    console.error("Create Payment ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to create payment" });
  }
});

// ---------------- IPN HANDLER ----------------
app.post(
  "/api/ipn",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const rawBody = req.body.toString("utf8");
      const sentSig = req.headers["x-nowpayments-sig"];

      console.log("----- IPN RECEIVED -----");
      console.log("RAW:", rawBody);

      const expectedSig = crypto
        .createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET)
        .update(rawBody)
        .digest("hex");

      console.log("SENT SIG:", sentSig);
      console.log("EXPECTED SIG:", expectedSig);

      if (sentSig !== expectedSig) {
        console.warn("⚠️ INVALID SIGNATURE");
        return res.status(403).send("Invalid signature");
      }

      console.log("IPN SIGNATURE VERIFIED");

      const data = JSON.parse(rawBody);
      const paymentId = data.payment_id;

      if (!orders[paymentId]) {
        console.log("Order not found in memory");
        return res.status(200).send("OK");
      }

      orders[paymentId].status = data.payment_status;

      if (
        ["finished", "confirmed", "sending"].includes(data.payment_status)
      ) {
        const prod = PRODUCTS[orders[paymentId].productId];
        const token = crypto.randomBytes(24).toString("hex");

        downloadTokens[token] = {
          filePath: getFilePath(prod.fileName),
          expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
        };

        orders[paymentId].downloadToken = token;
        console.log("Download token issued:", token);
      }

      return res.status(200).send("OK");
    } catch (err) {
      console.error("IPN ERROR:", err.message);
      return res.status(500).send("error");
    }
  }
);

// ---------------- CHECK ORDER STATUS ----------------
app.get("/api/order/:paymentId", (req, res) => {
  const order = orders[req.params.paymentId];
  if (!order) return res.status(404).json({ error: "Order not found" });

  return res.json({
    status: order.status,
    downloadToken: order.downloadToken,
  });
});

// ---------------- DOWNLOAD FILE ----------------
app.get("/api/download/:token", (req, res) => {
  const tokenData = downloadTokens[req.params.token];

  if (!tokenData) {
    return res.status(410).send("Download expired or invalid.");
  }

  if (Date.now() > tokenData.expiresAt) {
    delete downloadTokens[req.params.token];
    return res.status(410).send("Download expired. Please purchase again.");
  }

  const filePath = tokenData.filePath;

  delete downloadTokens[req.params.token];

  return res.download(filePath, path.basename(filePath));
});

// ---------------- HEALTH CHECK ----------------
app.get("/", (req, res) => {
  res.send("BYTRON NOWPayments backend running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
