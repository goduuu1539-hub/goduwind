import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { ConflictError, UnauthorizedError } from '../utils/httpError';

const signupSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long')
});

const signinSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required')
});

export const signup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = signupSchema.parse(req.body ?? {});
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      throw new ConflictError('User already exists');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash
      }
    });

    res.status(201).json({
      message: 'User created successfully',
      userId: user.id,
      email: user.email
    });
  } catch (error) {
    next(error);
  }
};

export const signin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = signinSchema.parse(req.body ?? {});
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      userId: user.id
    });
  } catch (error) {
    next(error);
  }
};
