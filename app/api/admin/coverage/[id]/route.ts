import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
const schema=z.object({active:z.boolean()});
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const auth=await requireAdminApi();if("error"in auth)return auth.error;const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Invalid coverage status"},{status:400});const{id}=await params;const area=await prisma.coverageArea.findUnique({where:{id}});if(!area)return NextResponse.json({error:"Coverage area not found"},{status:404});await prisma.$transaction(async tx=>{await tx.coverageArea.update({where:{id},data:{active:parsed.data.active}});await writeAuditLog({actorUserId:auth.session.userId,supplierCompanyId:area.supplierCompanyId,action:"ADMIN.COVERAGE_STATUS_UPDATED",entityType:"CoverageArea",entityId:id,summary:`Coverage area ${parsed.data.active?"enabled":"disabled"} by administrator`,request},tx)});return NextResponse.json({ok:true})}
