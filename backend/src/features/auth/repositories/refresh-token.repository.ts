import type { HydratedDocument, Types } from "mongoose";
import {
  RefreshTokenModel,
  type IRefreshToken,
} from "../models/refresh-token.model.js";
import { RevokedTokenFamilyModel } from "../models/revoked-token-family.model.js";

export type RefreshTokenDocument = HydratedDocument<IRefreshToken>;

export const refreshTokenRepository = {
  create: (data: {
    user: Types.ObjectId;
    tokenHash: string;
    family: string;
    expiresAt: Date;
  }): Promise<RefreshTokenDocument> => RefreshTokenModel.create(data),

  findByTokenHash: (tokenHash: string): Promise<RefreshTokenDocument | null> =>
    RefreshTokenModel.findOne({ tokenHash }).exec(),

  /**
   * Atomically marks an active, unexpired token as revoked and records its
   * replacement. Returns the updated document, or null when the token was
   * already revoked or expired - so exactly one of several concurrent
   * refresh requests can win the rotation.
   */
  claimForRotation: (
    tokenHash: string,
    replacedByTokenHash: string
  ): Promise<RefreshTokenDocument | null> =>
    RefreshTokenModel.findOneAndUpdate(
      {
        tokenHash,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { $set: { revokedAt: new Date(), replacedByTokenHash } },
      { returnDocument: "after" }
    ).exec(),

  /**
   * Kills a token family: writes a durable tombstone AND revokes every
   * un-revoked token document in the family. The tombstone is what makes
   * the revocation total - a token document inserted into the family after
   * this updateMany has run (a winning concurrent rotation) is still caught
   * by isFamilyRevoked on every subsequent use.
   */
  revokeFamily: async (
    family: string,
    tombstoneExpiresAt: Date
  ): Promise<void> => {
    const now = new Date();
    await Promise.all([
      // Upsert keeps this idempotent under concurrent reuse detections.
      RevokedTokenFamilyModel.updateOne(
        { family },
        {
          $setOnInsert: {
            family,
            revokedAt: now,
            expiresAt: tombstoneExpiresAt,
          },
        },
        { upsert: true }
      ).exec(),
      RefreshTokenModel.updateMany(
        { family, revokedAt: { $exists: false } },
        { $set: { revokedAt: now } }
      ).exec(),
    ]);
  },

  isFamilyRevoked: async (family: string): Promise<boolean> =>
    (await RevokedTokenFamilyModel.exists({ family }).exec()) !== null,

  revokeAllForUser: async (userId: Types.ObjectId): Promise<void> => {
    await RefreshTokenModel.updateMany(
      { user: userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } }
    ).exec();
  },
};
