import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { productCategorySchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
export async function POST(request:Request){const auth=await requireAdminApi();if("error"in auth)return auth.error;const parsed=productCategorySchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:validationError(parsed.error)},{status:400});try{const category=await prisma.$transaction(async tx=>{const saved=await tx.productCategory.create({data:parsed.data});await writeAuditLog({actorUserId:auth.session.userId,action:"ADMIN.CATEGORY_CREATED",entityType:"ProductCategory",entityId:saved.id,summary:`Product category ${saved.name} created`,request},tx);return saved});return NextResponse.json({ok:true,category},{status:201})}catch{return NextResponse.json({error:"A category with that name or slug already exists"},{status:409})}}
