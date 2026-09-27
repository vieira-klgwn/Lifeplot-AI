-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "goalId" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bedTime" TEXT NOT NULL DEFAULT '23:00',
ADD COLUMN     "breakMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "protectEvenings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wakeTime" TEXT NOT NULL DEFAULT '07:00',
ADD COLUMN     "workEndTime" TEXT NOT NULL DEFAULT '19:00',
ADD COLUMN     "workStartTime" TEXT NOT NULL DEFAULT '09:00';

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'PERSONAL',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "targetDate" DATE,
    "weeklyMinutes" INTEGER NOT NULL DEFAULT 60,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
