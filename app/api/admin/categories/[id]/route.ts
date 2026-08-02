import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
const schema=z.object({active:z.boolean()});
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const auth=await requireAdminApi();if("error"in auth)return auth.error;const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Invalid category status"},{status:400});const{id}=await params;const category=await prisma.productCategory.findUnique({where:{id}});if(!category)return NextResponse.json({error:"Category not found"},{status:404});await prisma.$transaction(async tx=>{await tx.productCategory.update({where:{id},data:{active:parsed.data.active}});await writeAuditLog({actorUserId:auth.session.userId,action:"ADMIN.CATEGORY_STATUS_UPDATED",entityType:"ProductCategory",entityId:id,summary:`Category ${category.name} ${parsed.data.active?"enabled":"disabled"}`,request},tx)});return NextResponse.json({ok:true})}
