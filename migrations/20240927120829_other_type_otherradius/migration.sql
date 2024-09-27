-- AlterTable
ALTER TABLE "Other" ADD COLUMN     "placedBy" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "OtherType" (
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "radius" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,

    CONSTRAINT "OtherType_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "OtherType_name_key" ON "OtherType"("name");
