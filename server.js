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

// middleware
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// store orders + download tokens
const orders = {};
const downloadTokens = {};

const PRODUCTS = {
  "1xbet-crash": { name: "1XBET Crash Hack", priceUsd: 100, fileName: "1xbet-crash.zip" },
  "1win-aviator-spribe": { name: "1WIN Aviator Hack", priceUsd: 100, fileName: "1win-aviator-spribe.zip" },
  luckyjet: { name: "LuckyJet Hack", priceUsd: 100, fileName: "luckyjet.zip" },
  "mostbet-aviator-spribe": { name: "Mostbet Aviator Hack", priceUsd: 100, fileName: "mostbet-aviator-spribe.zip" },
  "apple-of-fortune": { name: "Apple Of Fortune Hack", priceUsd: 100, fileName: "apple-of-fortune.zip" },
  thimbles: { name: "Thimbles Hack", priceUsd: 100, fileName: "thimbles.zip" },
  "wild-west-gold": { name: "Wild West Gold Hack", priceUsd: 100, fileName: "wild-west-gold.zip" },
  "higher-vs-lower": { name: "Higher VS Lower Hack", priceUsd: 100, fileName: "higher-vs-lower.zip" },
  "dragons-gold": { name: "Dragons Gold Hack", priceUsd: 100, fileName: "dragons-gold.zip" }
};

function getFilePath(fileName) {
  return path.join(__dirname, "files", fileName);
}

/* ---------------------------------------------------
   CREATE PAYMENT → NOWPAYMENTS INVOICE
--------------------------------------------------- */
app.post("/api/create-payment", async (req, res) => {
  try {
    const { productId } = req.body;
    const product = PRODUCTS[productId];

    if (!product) return res.status(400).json({ error: "Unknown productId" });

    const orderId = `${productId}-${Date.now()}`;

    // redirect back to the frontend download page
    const successUrl = `${process.env.FRONTEND_URL}/download/${productId}`;

    console.log("Creating invoice with success URL:", successUrl);

    const payload = {
      price_amount: product.priceUsd,
      price_currency: "usd",
      order_id: orderId,
      order_description: product.name,
      ipn_callback_url: `${process.env.BACKEND_URL}/api/ipn`,
      success_url: successUrl,
      cancel_url: process.env.PAYMENT_CANCEL_URL
    };

    console.log("Sending invoice payload:", payload);

    // NOWPayments – Create Invoice
    const response = await axios.post(
      "https://api.nowpayments.io/v1/invoice",
      payload,
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const invoice = response.data;

    console.log("NOWPayments Invoice Response:", invoice);

    // Save order (keyed by invoice.id)
    orders[invoice.id] = {
      orderId,
      productId,
      status: "waiting",
      downloadToken: null,
    };

    return res.json({
      invoiceId: invoice.id,
      invoiceUrl: invoice.invoice_url,
      orderId
    });

  } catch (err) {
    console.error("Create Payment ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to create payment" });
  }
});

/* ---------------------------------------------------
   IPN – Called by NOWPayments after payment
--------------------------------------------------- */
app.post("/api/ipn", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const rawBody = req.body.toString("utf8");
    const signature = req.headers["x-nowpayments-sig"];

    const expected = crypto
      .createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET)
      .update(rawBody)
      .digest("hex");

    if (signature !== expected) {
      console.log("❌ Invalid IPN signature");
      return res.status(403).send("Invalid signature");
    }

    const data = JSON.parse(rawBody);

    console.log("---- IPN RECEIVED ----");
    console.log(data);

    // FIX: find order by order_id (NOT payment_id)
    const orderId = data.order_id;
    let order = null;

    for (const invoiceId in orders) {
      if (orders[invoiceId].orderId === orderId) {
        order = orders[invoiceId];
        break;
      }
    }

    if (!order) {
      console.log("❌ Order not found for IPN");
      return res.status(200).send("OK");
    }

    // Update status
    order.status = data.payment_status;

    // Create download token if paid
    if (["finished", "confirmed", "sending"].includes(data.payment_status)) {
      const product = PRODUCTS[order.productId];
      const token = crypto.randomBytes(24).toString("hex");

      downloadTokens[token] = {
        filePath: getFilePath(product.fileName),
        expiresAt: Date.now() + 30 * 60 * 1000 // 30 minutes
      };

      order.downloadToken = token;
      console.log("✔ Download token generated:", token);
    }

    return res.status(200).send("OK");

  } catch (err) {
    console.error("IPN Error:", err.message);
    return res.status(500).send("Error");
  }
});

/* ---------------------------------------------------
   CHECK ORDER STATUS (Frontend polling)
--------------------------------------------------- */
app.get("/api/order/:paymentId", (req, res) => {
  const order = orders[req.params.paymentId];
  if (!order) return res.status(404).json({ error: "Order not found" });

  return res.json({
    status: order.status,
    downloadToken: order.downloadToken
  });
});

/* ---------------------------------------------------
   DOWNLOAD FILE
--------------------------------------------------- */
app.get("/api/download/:token", (req, res) => {
  const tokenData = downloadTokens[req.params.token];

  if (!tokenData) return res.status(410).send("Invalid or expired token");

  if (Date.now() > tokenData.expiresAt) {
    delete downloadTokens[req.params.token];
    return res.status(410).send("Token expired");
  }

  const filePath = tokenData.filePath;
  delete downloadTokens[req.params.token];

  return res.download(filePath, path.basename(filePath));
});

/* ---------------------------------------------------
   HEALTH CHECK
--------------------------------------------------- */
app.get("/", (req, res) => {
  res.send("BYTRON Payments Backend Running");
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
