import { Schema, model } from "mongoose";
import { USER_ROLES, USER_STATUSES } from "../types/user.types.js";
import type { UserRole, UserStatus } from "../types/user.types.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [EMAIL_REGEX, "Invalid email address"],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: "user",
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: "active",
    },
  },
  { timestamps: true }
);

userSchema.index({ status: 1 });

export const UserModel = model<IUser>("User", userSchema);
