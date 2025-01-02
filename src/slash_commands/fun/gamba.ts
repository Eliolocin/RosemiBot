import {
  EmbedBuilder,
  ApplicationCommandOptionType,
  Client,
  ChatInputCommandInteraction,
} from "discord.js";
import { Command, IUser } from "../../types";
import { localizer } from "../../utils/textLocalizer";
import UserModel from "../../models/userSchema";

const command: Command = {
  name: "gamba",
  description:
    "Gamble your TomoCoins with a 50/50 chance to double or lose it all!",
  category: "economy",
  options: [
    {
      name: "amount",
      description: "The number of TomoCoins you wish to gamble",
      type: ApplicationCommandOptionType.Integer,
      required: true,
    },
  ],

  callback: async (
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: IUser
  ): Promise<void> => {
    await interaction.deferReply();
    const locale = userData.language || "en";
    const gambleAmount = interaction.options.getInteger("amount", true);

    if (gambleAmount > userData.coins) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "economy.gamba.insufficient_funds_title"))
        .setDescription(
          localizer(locale, "economy.gamba.insufficient_funds_description", {
            balance: userData.coins,
            attempted: gambleAmount,
          })
        )
        .setFooter({
          text: localizer(locale, "economy.gamba.insufficient_funds_footer"),
        });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const isWin = Math.random() < 0.5;
    const winnings = isWin ? gambleAmount * 2 : 0;
    const finalAmount = isWin ? winnings - gambleAmount : -gambleAmount;

    await UserModel.updateOne(
      { userID: interaction.user.id },
      { $inc: { coins: finalAmount } }
    );

    const embed = new EmbedBuilder()
      .setColor(isWin ? "#00FF00" : "#FF0000")
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
      })
      .setTitle(
        localizer(
          locale,
          isWin ? "economy.gamba.win_title" : "economy.gamba.lose_title"
        )
      )
      .setDescription(
        localizer(
          locale,
          isWin
            ? "economy.gamba.win_description"
            : "economy.gamba.lose_description",
          {
            winnings: isWin ? winnings : "",
            amount_lost: !isWin ? gambleAmount : "",
            new_balance: userData.coins + finalAmount,
          }
        )
      )
      .setFooter({
        text: localizer(
          locale,
          isWin ? "economy.gamba.win_footer" : "economy.gamba.lose_footer"
        ),
      });

    await interaction.editReply({ embeds: [embed] });
  },
} as const;

export default command;
