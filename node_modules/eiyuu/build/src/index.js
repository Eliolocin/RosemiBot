"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseString = exports.Eiyuu = void 0;
// Client
const Eiyuu_1 = __importDefault(require("./class/Eiyuu"));
exports.Eiyuu = Eiyuu_1.default;
/**
 * Optional methods
 * Converts arrays with each string separated by a comma.
 * @param {string[]} data - The array of strings to convert.
 * @return {string} The converted string.
 */
function parseString(data) {
    return data.join(", ");
}
exports.parseString = parseString;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsU0FBUztBQUNULDBEQUFrQztBQVl6QixnQkFaRixlQUFLLENBWUU7QUFWZDs7Ozs7R0FLRztBQUNILFNBQVMsV0FBVyxDQUFDLElBQWM7SUFDakMsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3pCLENBQUM7QUFFZSxrQ0FBVyJ9