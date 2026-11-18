import type { HydratedDocument } from "mongoose";
import { UserModel, type IUser } from "../models/user.model.js";

export type UserDocument = HydratedDocument<IUser>;

export const userRepository = {
  create: (data: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<UserDocument> => UserModel.create(data),

  findByEmail: (email: string): Promise<UserDocument | null> =>
    UserModel.findOne({ email: email.toLowerCase() }).exec(),

  findByEmailWithPassword: (email: string): Promise<UserDocument | null> =>
    UserModel.findOne({ email: email.toLowerCase() })
      .select("+passwordHash")
      .exec(),

  findById: (id: string): Promise<UserDocument | null> =>
    UserModel.findById(id).exec(),
};
