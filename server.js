import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
app.get("/test", (req, res) => {
  res.send("BYTRON Backend Working 🚀");
});

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// needed to build absolute file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// normal JSON for all routes except IPN
app.use(cors());
app.use(express.json());

// ---------- SIMPLE IN-MEMORY STORAGE (OK FOR LOW TRAFFIC) ----------
/**
 * orders[paymentId] = {
 *   productId,
 *   status: "waiting" | "finished" | ...,
 *   downloadToken
 * }
 */
const orders = {};
/**
 * downloadTokens[token] = {
 *   productId,
 *   filePath,
 *   expiresAt: Date
 * }
 */
const downloadTokens = {};

// ---------- PRODUCT CONFIG ----------
const PRODUCTS = {
  "1xbet-crash": {
    name: "1xbet Crash",
    priceUsd: 100,
    fileName: "1xbet-crash.zip",
  },
  "1win-aviator-spribe": {
    name: "1win Aviator Spribe",
    priceUsd: 100,
    fileName: "1win-aviator-spribe.zip",
  },
  luckyjet: {
    name: "LuckyJet",
    priceUsd: 100,
    fileName: "luckyjet.zip",
  },
  "mostbet-aviator-spribe": {
    name: "Mostbet Aviator Spribe",
    priceUsd: 100,
    fileName: "mostbet-aviator-spribe.zip",
  },
  "apple-of-fortune": {
    name: "Apple Of Fortune",
    priceUsd: 100,
    fileName: "apple-of-fortune.zip",
  },
  thimbles: {
    name: "Thimbles",
    priceUsd: 100,
    fileName: "thimbles.zip",
  },
  "wild-west-gold": {
    name: "Wild West Gold",
    priceUsd: 100,
    fileName: "wild-west-gold.zip",
  },
  "higher-vs-lower": {
    name: "Higher VS Lower",
    priceUsd: 100,
    fileName: "higher-vs-lower.zip",
  },
  "dragons-gold": {
    name: "Dragons Gold",
    priceUsd: 100,
    fileName: "dragons-gold.zip",
  },
};

function getFilePath(fileName) {
  return path.join(__dirname, "files", fileName);
}

// ---------- CREATE PAYMENT ----------
app.post("/api/create-payment", async (req, res) => {
  try {
    const { productId, payCurrency = "usdttrc20" } = req.body;

    const product = PRODUCTS[productId];
    if (!product) {
      return res.status(400).json({ error: "Unknown productId" });
    }

    const orderId = `${productId}-${Date.now()}`;

    const body = {
      price_amount: product.priceUsd,
      price_currency: "usd",
      pay_currency: payCurrency, // e.g. usdttrc20, btc, etc
      order_id: orderId,
      order_description: product.name,
      ipn_callback_url: `${process.env.BACKEND_URL || ""}/api/ipn`,
      success_url: process.env.PAYMENT_SUCCESS_URL,
      cancel_url: process.env.PAYMENT_CANCEL_URL,
    };

    const resp = await axios.post(
      "https://api.nowpayments.io/v1/payment",
      body,
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const payment = resp.data;

    // store minimal data about this order
    orders[payment.payment_id] = {
      productId,
      status: payment.payment_status || "waiting",
      downloadToken: null,
    };

    return res.json({
      paymentId: payment.payment_id,
      paymentStatus: payment.payment_status,
      payAddress: payment.pay_address,
      payAmount: payment.pay_amount,
      payCurrency: payment.pay_currency,
      paymentUrl: payment.invoice_url || payment.payment_url, // whichever field they give
    });
  } catch (err) {
    console.error("create-payment error:", err.response?.data || err.message);
    return res
      .status(500)
      .json({ error: "Failed to create payment with NOWPayments" });
  }
});

// ---------- IPN WEBHOOK (needs raw body for signature) ----------
app.post(
  "/api/ipn",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const payload = req.body.toString("utf8");
      const signature = req.headers["x-nowpayments-sig"];

      const expected = crypto
        .createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET)
        .update(payload)
        .digest("hex");

      if (!signature || signature !== expected) {
        console.warn("Invalid IPN signature");
        return res.status(401).send("Invalid signature");
      }

      const data = JSON.parse(payload);

      const paymentId = data.payment_id;
      const paymentStatus = data.payment_status;

      const order = orders[paymentId];
      if (!order) {
        console.warn("IPN for unknown payment:", paymentId);
        return res.status(200).send("OK");
      }

      order.status = paymentStatus;

      // When finished/confirmed -> create 30-min download token
      if (
        paymentStatus === "finished" ||
        paymentStatus === "confirmed" ||
        paymentStatus === "sending"
      ) {
        const product = PRODUCTS[order.productId];
        if (product) {
          const token = crypto.randomBytes(24).toString("hex");
          const filePath = getFilePath(product.fileName);
          const expiresAt = Date.now() + 30 * 60 * 1000; // 30 min

          downloadTokens[token] = {
            productId: order.productId,
            filePath,
            expiresAt,
          };

          order.downloadToken = token;
        }
      }

      // NOWPayments expects 200 OK
      return res.status(200).send("OK");
    } catch (err) {
      console.error("IPN error:", err.message);
      return res.status(500).send("IPN error");
    }
  }
);

// ---------- CHECK ORDER (frontend can poll this) ----------
app.get("/api/order/:paymentId", (req, res) => {
  const { paymentId } = req.params;
  const order = orders[paymentId];
  if (!order) return res.status(404).json({ error: "Order not found" });

  return res.json({
    status: order.status,
    downloadToken: order.downloadToken || null,
  });
});

// ---------- DOWNLOAD ----------
app.get("/api/download/:token", (req, res) => {
  const { token } = req.params;
  const info = downloadTokens[token];

  if (!info) {
    return res
      .status(410)
      .send("Download link expired or invalid. Please contact support.");
  }

  if (Date.now() > info.expiresAt) {
    delete downloadTokens[token];
    return res
      .status(410)
      .send("Download link expired. You need to purchase again.");
  }

  // one-time download: delete token before sending
  delete downloadTokens[token];

  return res.download(info.filePath, path.basename(info.filePath), (err) => {
    if (err) {
      console.error("Download error:", err.message);
    }
  });
});

// ---------- HEALTH ----------
app.get("/", (_req, res) => {
  res.send("BYTRON payments backend alive");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

