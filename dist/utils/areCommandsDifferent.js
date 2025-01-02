"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const areCommandsDifferent = (existingCommand, localCommand) => {
    const areChoicesDifferent = (existingChoices, localChoices) => {
        if (!localChoices)
            return false;
        for (const localChoice of localChoices) {
            const existingChoice = existingChoices?.find((choice) => choice.name === localChoice.name);
            if (!existingChoice)
                return true;
            if (localChoice.value !== existingChoice.value)
                return true;
        }
        return false;
    };
    const areOptionsDifferent = (existingOptions, localOptions) => {
        if (!localOptions)
            return false;
        for (const localOption of localOptions) {
            const existingOption = existingOptions?.find((option) => option.name === localOption.name);
            if (!existingOption)
                return true;
            if (localOption.description !== existingOption.description ||
                localOption.type !== existingOption.type ||
                (localOption.required || false) !==
                    (existingOption.required || false) ||
                (localOption.choices?.length || 0) !==
                    (existingOption.choices?.length || 0) ||
                areChoicesDifferent(existingOption.choices, localOption.choices)) {
                return true;
            }
        }
        return false;
    };
    return (existingCommand.description !== localCommand.description ||
        (existingCommand.options?.length || 0) !==
            (localCommand.options?.length || 0) ||
        areOptionsDifferent(existingCommand.options, localCommand.options));
};
exports.default = areCommandsDifferent;
