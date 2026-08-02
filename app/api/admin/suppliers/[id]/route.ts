import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { adminSupplierEditSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const auth=await requireAdminApi();if("error"in auth)return auth.error;const parsed=adminSupplierEditSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:validationError(parsed.error)},{status:400});const{id}=await params;const existing=await prisma.supplierCompany.findUnique({where:{id}});if(!existing)return NextResponse.json({error:"Supplier not found"},{status:404});await prisma.$transaction(async tx=>{await tx.supplierCompany.update({where:{id},data:parsed.data});await writeAuditLog({actorUserId:auth.session.userId,supplierCompanyId:id,action:"ADMIN.SUPPLIER_EDITED",entityType:"SupplierCompany",entityId:id,summary:"Administrator edited supplier company details",request},tx)});return NextResponse.json({ok:true})}
