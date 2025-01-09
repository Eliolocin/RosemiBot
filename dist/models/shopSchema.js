"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
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
// Ensure model doesn't get registered multiple times
const ShopModel = mongoose_1.default.models.shops || (0, mongoose_1.model)("shops", shopSchema);
exports.default = ShopModel;
//# sourceMappingURL=shopSchema.js.map