import { Schema, model, type Types } from "mongoose";

export interface IRefreshToken {
  user: Types.ObjectId;
  /** SHA-256 hash of the raw refresh token. The raw token is never stored. */
  tokenHash: string;
  /** Rotation family id. All tokens issued via rotation share a family;
      reuse of a rotated token revokes the entire family. */
  family: string;
  expiresAt: Date;
  revokedAt?: Date;
  replacedByTokenHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    family: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
    },
    replacedByTokenHash: {
      type: String,
    },
  },
  { timestamps: true }
);

// MongoDB automatically removes expired token documents.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<IRefreshToken>(
  "RefreshToken",
  refreshTokenSchema
);
