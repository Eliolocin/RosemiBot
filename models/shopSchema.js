const mongoose = require("mongoose");

const shopSchema = new mongoose.Schema({
  serverID: { type: String, require: true }, // The ID of the Discord server where the shop exists
  shopName: { type: String, default: "Server Shop" }, // Optional: Name of the shop
  currency: { type: String, default: "TomoCoins" }, // Currency used (e.g., "coins")

  items: {
    type: [
      {
        itemID: { type: String, required: true, unique: true }, // Unique identifier for the item
        name: { type: String, required: true }, // Name of the item
        price: { type: Number, required: true }, // Price of the item
        quantityAvailable: { type: Number, default: 0 }, // Stock quantity (0 means out of stock)
        description: { type: String }, // Optional: Description of the item
        attributes: {
          type: [
            {
              key: { type: String, required: true }, // Attribute key (e.g., "rarity", "effect")
              value: { type: mongoose.Schema.Types.Mixed, required: true }, // Attribute value
            },
          ],
          default: [], // Default to no additional attributes
        },
      },
    ],
    default: [], // Default to no items in the shop
  },

  // Purchase log to track transactions (Optional but helpful for auditing or refunds)
  transactionLog: {
    type: [
      {
        userID: { type: String, required: true }, // The Discord user who made the purchase
        itemID: { type: String, required: true }, // The item purchased
        quantity: { type: Number, required: true }, // Quantity of the item purchased
        totalCost: { type: Number, required: true }, // Total cost of the transaction
        date: { type: Date, default: Date.now }, // Timestamp of the transaction
      },
    ],
    default: [], // Default to no transactions
  },
});

const model = mongoose.model("shops", shopSchema);
module.exports = model;
