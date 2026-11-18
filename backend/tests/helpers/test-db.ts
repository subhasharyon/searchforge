import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongo: MongoMemoryServer | undefined;

export const startTestDb = async (): Promise<void> => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("searchforge_test"));
};

export const stopTestDb = async (): Promise<void> => {
  await mongoose.disconnect();
  await mongo?.stop();
};
