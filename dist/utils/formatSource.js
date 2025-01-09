"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFormattedSource = void 0;
const getFormattedSource = (url) => {
    if (!url)
        return "(No source provided)";
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split("/").filter(Boolean);
        const relevantParts = pathParts.slice(0, 3);
        return `${urlObj.hostname}/${relevantParts.join("/")}`;
    }
    catch {
        return url;
    }
};
exports.getFormattedSource = getFormattedSource;
//# sourceMappingURL=formatSource.js.map