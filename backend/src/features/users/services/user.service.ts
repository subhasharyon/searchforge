import { userRepository, type UserDocument } from "../repositories/user.repository.js";
import type { PublicUser } from "../types/user.types.js";

export const toPublicUser = (user: UserDocument): PublicUser => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const getPublicUserById = async (
  id: string
): Promise<PublicUser | null> => {
  const user = await userRepository.findById(id);
  return user ? toPublicUser(user) : null;
};
