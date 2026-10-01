import { PrismaClient, Prisma } from '@prisma/client';
export const prisma = new PrismaClient({ log: ['warn', 'error'] });
export type Tx = Prisma.TransactionClient;
