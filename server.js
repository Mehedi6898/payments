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

    // 🔥 Dynamic redirect back to frontend download page
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

    // Save order
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
    const paymentId = data.payment_id;

    console.log("---- IPN RECEIVED ----");
    console.log(data);

    const order = orders[paymentId];
    if (!order) return res.status(200).send("OK");

    order.status = data.payment_status;

    if (["finished", "confirmed", "sending"].includes(data.payment_status)) {
      const product = PRODUCTS[order.productId];
      const token = crypto.randomBytes(24).toString("hex");

      downloadTokens[token] = {
        filePath: getFilePath(product.fileName),
        expiresAt: Date.now() + 30 * 60 * 1000 // 30 minutes
      };

      order.downloadToken = token;
      console.log("Download token generated:", token);
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

// ORDER + DOWNLOAD TOKENS
const orders = {};
const downloadTokens = {};

// PRODUCT DATABASE
const PRODUCTS = {
  "1xbet-crash": {
    name: "1xbet Crash Hack",
    priceUsd: 100,
    fileName: "1xbet-crash.zip",
  },
  luckyjet: {
    name: "LuckyJet Hack",
    priceUsd: 100,
    fileName: "luckyjet.zip",
  },
  thimbles: {
    name: "Thimbles Hack",
    priceUsd: 100,
    fileName: "thimbles.zip",
  },
  "apple-of-fortune": {
    name: "Apple Of Fortune Hack",
    priceUsd: 100,
    fileName: "apple-of-fortune.zip",
  },
  "1win-aviator-spribe": {
    name: "1WIN Aviator Hack",
    priceUsd: 100,
    fileName: "1win-aviator-spribe.zip",
  },
  "mostbet-aviator-spribe": {
    name: "Mostbet Aviator Hack",
    priceUsd: 100,
    fileName: "mostbet-aviator-spribe.zip",
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

// GET ABSOLUTE FILE PATH
function getFilePath(fileName) {
  return path.join(__dirname, "files", fileName);
}

// ---------------------- CREATE INVOICE ----------------------
app.post("/api/create-payment", async (req, res) => {
  try {
    const { productId } = req.body;

    const product = PRODUCTS[productId];
    if (!product) {
      return res.status(400).json({ error: "Invalid productId" });
    }

    const orderId = `${productId}-${Date.now()}`;

    const payload = {
      price_amount: product.priceUsd,
      price_currency: "usd",
      order_id: orderId,
      order_description: product.name,
      ipn_callback_url: `${process.env.BACKEND_URL}/api/ipn`,
      success_url: process.env.PAYMENT_SUCCESS_URL,
      cancel_url: process.env.PAYMENT_CANCEL_URL,
    };

    console.log("Sending invoice payload:", payload);

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

    const data = response.data;
    console.log("NOWPayments Invoice Response:", data);

    orders[data.id] = {
      productId,
      status: data.status,
      downloadToken: null,
    };

    return res.json({
      invoiceId: data.id,
      invoiceUrl: data.invoice_url,
    });

  } catch (err) {
    console.error("Invoice creation error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to create invoice" });
  }
});

// ---------------------- IPN HANDLER ----------------------
app.post(
  "/api/ipn",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const payload = req.body.toString("utf8");
      const sentSig = req.headers["x-nowpayments-sig"];

      const expectedSig = crypto
        .createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET)
        .update(payload)
        .digest("hex");

      if (sentSig !== expectedSig) {
        console.warn("Invalid signature");
        return res.status(403).send("Invalid signature");
      }

      const data = JSON.parse(payload);
      const invoiceId = data.invoice_id;

      const order = orders[invoiceId];
      if (!order) return res.status(200).send("OK");

      order.status = data.payment_status;

      if (data.payment_status === "finished") {
        const product = PRODUCTS[order.productId];
        if (product) {
          const token = crypto.randomBytes(24).toString("hex");
          downloadTokens[token] = {
            filePath: getFilePath(product.fileName),
            expiresAt: Date.now() + 30 * 60 * 1000,
          };
          order.downloadToken = token;
        }
      }

      return res.status(200).send("OK");

    } catch (err) {
      console.error("IPN error:", err.message);
      return res.status(500).send("error");
    }
  }
);

// CHECK ORDER STATUS
app.get("/api/order/:invoiceId", (req, res) => {
  const order = orders[req.params.invoiceId];
  if (!order) return res.status(404).json({ error: "Order not found" });

  res.json({
    status: order.status,
    downloadToken: order.downloadToken,
  });
});

// DOWNLOAD FILE
app.get("/api/download/:token", (req, res) => {
  const tokenData = downloadTokens[req.params.token];

  if (!tokenData) {
    return res.status(410).send("Download expired or invalid.");
  }

  if (Date.now() > tokenData.expiresAt) {
    delete downloadTokens[req.params.token];
    return res.status(410).send("Download expired. Buy again.");
  }

  const filePath = tokenData.filePath;
  delete downloadTokens[req.params.token];

  return res.download(filePath, path.basename(filePath));
});

// ROOT CHECK
app.get("/", (req, res) => {
  res.send("NOWPayments Invoice Backend Running");
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

