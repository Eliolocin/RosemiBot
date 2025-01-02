"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const getAllFiles = (directory, foldersOnly = false) => {
    let fileNames = [];
    const files = fs_1.default.readdirSync(directory, { withFileTypes: true });
    for (const file of files) {
        const filePath = path_1.default.join(directory, file.name);
        if (foldersOnly) {
            if (file.isDirectory()) {
                fileNames.push(filePath);
            }
        }
        else {
            if (file.isFile()) {
                fileNames.push(filePath);
            }
        }
    }
    return fileNames;
};
exports.default = getAllFiles;
