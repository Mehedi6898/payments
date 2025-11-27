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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.raw({ type: "application/json" }));

// ---------------- PRODUCTS ----------------
const PRODUCTS = {
  "apple-of-fortune": {
    name: "Apple Of Fortune Hack",
    priceUsd: 100,
    fileName: "apple-of-fortune.zip"
  },
  "thimbles": {
    name: "Thimbles Hack",
    priceUsd: 100,
    fileName: "thimbles.zip"
  }
  // add the rest...
};

const orders = {};
const downloadTokens = {};

function getFilePath(file) {
  return path.join(__dirname, "files", file);
}

// ---------------- CREATE PAYMENT (INVOICE) ----------------
app.post("/api/create-payment", async (req, res) => {
  try {
    const { productId } = req.body;
    const product = PRODUCTS[productId];

    if (!product) return res.json({ error: "Invalid product" });

    const orderId = `${productId}-${Date.now()}`;

    const payload = {
      price_amount: product.priceUsd,
      price_currency: "usd",
      order_id: orderId,
      order_description: product.name,
      ipn_callback_url: `${process.env.BACKEND_URL}/api/ipn`,
      success_url: process.env.PAYMENT_SUCCESS_URL,
      cancel_url: process.env.PAYMENT_CANCEL_URL
    };

    const response = await axios.post(
      "https://api.nowpayments.io/v1/invoice",
      payload,
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const invoice = response.data;

    orders[invoice.id] = {
      productId,
      status: invoice.status,
      downloadToken: null
    };

    return res.json({
      paymentId: invoice.id,
      paymentUrl: invoice.invoice_url
    });

  } catch (err) {
    console.log("Create payment error:", err.response?.data || err.message);
    return res.json({ error: "Failed to create payment" });
  }
});

// ---------------- IPN ----------------
app.post("/api/ipn", (req, res) => {
  try {
    const raw = req.body.toString("utf8");
    const sentSig = req.headers["x-nowpayments-sig"];

    const expectedSig = crypto
      .createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET)
      .update(raw)
      .digest("hex");

    if (sentSig !== expectedSig) {
      console.log("Invalid signature");
      return res.status(403).send("Invalid signature");
    }

    const data = JSON.parse(raw);
    const order = orders[data.id];
    if (!order) return res.send("OK");

    order.status = data.payment_status;

    if (["finished", "confirmed", "sending"].includes(order.status)) {
      const product = PRODUCTS[order.productId];
      const token = crypto.randomBytes(24).toString("hex");

      downloadTokens[token] = {
        filePath: getFilePath(product.fileName),
        expiresAt: Date.now() + 30 * 60 * 1000
      };

      order.downloadToken = token;
    }

    return res.send("OK");
  } catch (err) {
    console.log("IPN error:", err.message);
    return res.status(500).send("error");
  }
});

// ---------------- ORDER CHECK ----------------
app.get("/api/order/:id", (req, res) =>
  res.json(orders[req.params.id] || { error: "not found" })
);

// ---------------- DOWNLOAD ----------------
app.get("/api/download/:token", (req, res) => {
  const t = downloadTokens[req.params.token];
  if (!t) return res.status(410).send("Expired");

  if (Date.now() > t.expiresAt) {
    delete downloadTokens[req.params.token];
    return res.status(410).send("Expired");
  }

  const file = t.filePath;
  delete downloadTokens[req.params.token];

  res.download(file, path.basename(file));
});

app.get("/", (req, res) => {
  res.send("BYTRON NOWPayments backend OK");
});

app.listen(PORT, () => console.log("Server running on", PORT));
