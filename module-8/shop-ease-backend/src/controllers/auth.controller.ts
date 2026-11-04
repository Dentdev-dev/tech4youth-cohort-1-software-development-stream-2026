import type { Request, Response } from "express";
import * as authService from "../services/auth.service.ts";

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body);
  res.status(201).json({ success: true, data: result });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  res.status(200).json({ success: true, data: result });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.user!.userId);
  res
    .status(200)
    .json({ success: true, message: "Logged out of all sessions" });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await authService.getProfile(req.user!.userId);
  res.status(200).json({ success: true, data: user });
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const user = await authService.updateProfile(req.user!.userId, req.body);
  res.status(200).json({ success: true, data: user });
}

export async function forgotPassword(
  req: Request,
  res: Response,
): Promise<void> {
  await authService.forgotPassword(req.body.email);
  res.status(200).json({
    success: true,
    message: "If an account exists for that email, a reset link has been sent",
  });
}

export async function resetPassword(
  req: Request,
  res: Response,
): Promise<void> {
  await authService.resetPassword(req.body);
  res.status(200).json({
    success: true,
    message: "Password has been reset. Please log in with your new password",
  });
}

export async function changePassword(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await authService.changePassword(req.user!.userId, req.body);
  res.status(200).json({
    success: true,
    message: "Password changed. Other sessions have been signed out",
    data: result,
  });
}
