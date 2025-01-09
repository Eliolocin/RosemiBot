require("dotenv").config();
const mongoose = require("mongoose");
const botModel = require("../models/botSchema");
const userModel = require("../models/userSchema");
const shopModel = require("../models/shopSchema");

async function updateCollection(model, modelName) {
  try {
    // Find all documents
    const documents = await model.find({});
    let updated = 0;

    // Update each document
    for (const doc of documents) {
      const originalDoc = { ...doc.toObject() };
      // Save document to trigger Mongoose defaults
      await doc.save();

      // Check if document was modified
      if (JSON.stringify(originalDoc) !== JSON.stringify(doc.toObject())) {
        updated++;
      }
    }

    console.log(
      `${modelName}: Updated ${updated}/${documents.length} documents`
    );
    return { total: documents.length, updated };
  } catch (err) {
    console.error(`Error updating ${modelName}:`, err);
    return { error: err.message };
  }
}

async function updateDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_SRV);
    console.log("::group::Database Update Summary");

    const results = await Promise.all([
      updateCollection(botModel, "Bots"),
      updateCollection(userModel, "Users"),
      updateCollection(shopModel, "Shops"),
    ]);

    let hasErrors = false;
    results.forEach((result, index) => {
      const collection = ["Bots", "Users", "Shops"][index];
      if (result.error) {
        console.log(`::error::${collection}: ${result.error}`);
        hasErrors = true;
      } else {
        console.log(
          `${collection}: ${result.updated} of ${result.total} documents updated`
        );
      }
    });

    console.log("::endgroup::");

    if (hasErrors) {
      throw new Error("One or more collections failed to update");
    }
  } catch (err) {
    console.error("::error::Database update failed:", err);
    process.exit(1); // Will fail CI pipeline
  } finally {
    await mongoose.disconnect();
  }
}

// Run if called directly (not imported)
if (require.main === module) {
  updateDatabase().then(() => process.exit(0));
}

module.exports = updateDatabase;

/*
Usage:
node scripts/dbUpdate.js
or
npm run db-update

CI/CD Integration:
Add the following script to your package.json file:
"scripts": {
  "db-update": "node scripts/dbUpdate.js"
}
Then, you can run the script using npm run db-update.
name: Database Schema Update

on:
  push:
    paths:
      - 'models/*.js'
    branches:
      - main

jobs:
  update-db:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
      - run: npm install
      - name: Update Database Schemas
        run: npm run db-update
        env:
          MONGODB_SRV: ${{ secrets.MONGODB_SRV }}
*/
