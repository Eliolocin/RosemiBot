import { Client, ActivityType, ActivityOptions } from "discord.js";

const handler = async (client: Client): Promise<void> => {
  console.log(`${client.user?.tag} up and growing!`);

  const status: ActivityOptions[] = [
    {
      name: "Kawaii Future Bass music",
      type: ActivityType.Listening,
    },
    {
      name: "=help",
      type: ActivityType.Listening,
    },
    // ...existing status entries...
  ];

  setInterval(() => {
    const random = Math.floor(Math.random() * status.length);
    client.user?.setActivity(status[random]);
  }, 600000);

  client.user?.setActivity(status[1]);
};

export default handler;
