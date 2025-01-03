import {
  Client,
  ApplicationCommand,
  ApplicationCommandOption,
  VoiceState,
  Presence,
  Guild,
  GuildMember,
  PermissionsBitField,
  TextBasedChannel, // Add this
} from "discord.js";
import { Document } from "mongoose";
import {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
} from "discord.js";

export interface LocalCommand {
  name: string;
  description: string;
  options?: ApplicationCommandOption[];
  permissionsRequired?: string[];
  choices?: Array<{
    name: string;
    value: string | number;
  }>;
}

export interface Locales {
  [key: string]: {
    [key: string]: any;
  };
}

export interface LocalizerVariables {
  [key: string]: string | number;
}

export type EventFunction = {
  (client: Client, arg1: any, arg2?: any): Promise<void>;
};

export interface EventFile {
  name: string;
  path: string;
  function: EventFunction;
}

export type EventArg = VoiceState | Presence | any;

export interface IUser {
  userID: string;
  serverID: string;
  nickname: string;
  level: number;
  xp: number;
  coins: number;
  bank: number;
  inventory: Array<{
    itemID: string;
    name: string;
    quantity: number;
    description?: string;
  }>;
  language: string;
  conversationExamples: Array<{
    input: string;
    output: string;
  }>;
  botDatabase: string[];
  isPersonalized: boolean;
  cooldowns: Map<string, number>;
  counters: number[];
}

export interface IBot extends Document {
  serverID: string;
  botName: string;
  conversationExamples: Array<{
    input: string;
    output: string;
  }>;
  botDatabase: string[];
  settings: Array<{
    key: string;
    value: any;
    description: string;
  }>;
  triggers: string[];
  counters: number[];
}

export interface IShop extends Document {
  serverID: string;
  shopName: string;
  currency: string;
  items: Array<{
    itemID: string;
    name: string;
    price: number;
    quantityAvailable: number;
    description?: string;
    attributes: Array<{
      key: string;
      value: any;
    }>;
  }>;
  transactionLog: Array<{
    userID: string;
    itemID: string;
    quantity: number;
    totalCost: number;
    date: Date;
  }>;
}

export interface Command {
  name: string;
  description: string;
  category?: string;
  permissionsRequired?: bigint[]; // Using bigint for PermissionsBitField flags
  options?: {
    name: string;
    description: string;
    type: ApplicationCommandOptionType;
    required?: boolean;
    choices?: Array<{
      name: string;
      value: string | number;
    }>;
  }[];
  callback: (
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: IUser
  ) => Promise<void>;
}

export interface BooruPost {
  data: Record<string, any>;
  booru: string;
  fileUrl: string;
  id: string;
  tags: string[];
  score: number;
  source?: string;
  rating: string;
  createdAt: Date;
  postView: string;
  height?: number;
  width?: number;
  sampleUrl?: string;
}

export interface BooruSearchResults {
  posts: BooruPost[];
  booru: string;
  tags: string[];
  limit: number;
  offset: number;
}

export interface BooruSearchOptions {
  limit?: number;
  random?: boolean;
  tags?: string[];
}

export interface RawBooruPost {
  fileUrl: string;
  source?: string;
  id: string;
  tags: string[];
  score: number;
  rating: string;
  createdAt: Date;
  postView: string;
}
