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

// dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// middleware
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// in-memory database
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
    name: "1WIN Aviator Hack",
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

function getFilePath(fileName) {
  return path.join(__dirname, "files", fileName);
}

// ---------------- CREATE PAYMENT ----------------
app.post("/api/create-payment", async (req, res) => {
  try {
    const { productId, payCurrency = "usdttrc20" } = req.body;

    const product = PRODUCTS[productId];
    if (!product) {
      return res.status(400).json({ error: "Unknown productId" });
    }

    const orderId = `${productId}-${Date.now()}`;

    const payload = {
      price_amount: product.priceUsd,
      price_currency: "usd",
      pay_currency: payCurrency,
      order_id: orderId,
      order_description: product.name,
      ipn_callback_url: `${process.env.BACKEND_URL}/api/ipn`,
      success_url: process.env.PAYMENT_SUCCESS_URL,
      cancel_url: process.env.PAYMENT_CANCEL_URL,
    };

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

    // save minimal info
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
    console.error("NOWPayments error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to create payment" });
  }
});

// ---------------- IPN WEBHOOK ----------------
app.post(
  "/api/ipn",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const payload = req.body.toString("utf8");
      const sentSig = req.headers["x-nowpayments-sig"];

      // ========= TEST IPN SUPPORT =========
      if (sentSig === "test_signature") {
        console.log("NOWPayments TEST IPN received");
        return res.status(200).send("OK");
      }

      // ========= REAL SIGNATURE VALIDATION =========
      const expectedSig = crypto
        .createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET)
        .update(payload)
        .digest("hex");

      if (sentSig !== expectedSig) {
        console.warn("Invalid signature");
        return res.status(403).send("Invalid signature");
      }

      const data = JSON.parse(payload);
      const paymentId = data.payment_id;
      const order = orders[paymentId];

      if (!order) return res.status(200).send("OK");

      order.status = data.payment_status;

      // payment completed → generate download token
      if (
        data.payment_status === "finished" ||
        data.payment_status === "confirmed" ||
        data.payment_status === "sending"
      ) {
        const product = PRODUCTS[order.productId];
        if (product) {
          const token = crypto.randomBytes(24).toString("hex");

          downloadTokens[token] = {
            filePath: getFilePath(product.fileName),
            expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
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

  // remove token after download
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
