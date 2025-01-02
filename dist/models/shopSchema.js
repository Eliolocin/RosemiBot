"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const shopSchema = new mongoose_1.Schema({
    serverID: { type: String, required: true },
    shopName: { type: String, default: "Server Shop" },
    currency: { type: String, default: "TomoCoins" },
    items: [
        {
            itemID: { type: String, required: true, unique: true },
            name: { type: String, required: true },
            price: { type: Number, required: true },
            quantityAvailable: { type: Number, default: 0 },
            description: { type: String },
            attributes: [
                {
                    key: { type: String, required: true },
                    value: { type: mongoose_1.Schema.Types.Mixed, required: true },
                },
            ],
        },
    ],
    transactionLog: [
        {
            userID: { type: String, required: true },
            itemID: { type: String, required: true },
            quantity: { type: Number, required: true },
            totalCost: { type: Number, required: true },
            date: { type: Date, default: Date.now },
        },
    ],
});
const ShopModel = (0, mongoose_1.model)("shops", shopSchema);
exports.default = ShopModel;
