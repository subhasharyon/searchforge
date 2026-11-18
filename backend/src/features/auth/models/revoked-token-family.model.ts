import { Schema, model } from "mongoose";

export interface IRevokedTokenFamily {
  /** Token family id that was killed after refresh token reuse. */
  family: string;
  revokedAt: Date;
  /** Tombstones only need to outlive the longest-lived token in the family;
      they are removed automatically after this instant. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const revokedTokenFamilySchema = new Schema<IRevokedTokenFamily>(
  {
    family: {
      type: String,
      required: true,
      unique: true,
    },
    revokedAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

revokedTokenFamilySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RevokedTokenFamilyModel = model<IRevokedTokenFamily>(
  "RevokedTokenFamily",
  revokedTokenFamilySchema
);
