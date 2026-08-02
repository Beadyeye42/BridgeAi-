import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const auth=await requireAdminApi();if("error"in auth)return auth.error;const{id}=await params;const event=await prisma.systemEvent.findUnique({where:{id}});if(!event)return NextResponse.json({error:"System event not found"},{status:404});await prisma.$transaction(async tx=>{await tx.systemEvent.update({where:{id},data:{status:"RESOLVED",resolvedAt:new Date(),resolvedById:auth.session.userId}});await writeAuditLog({actorUserId:auth.session.userId,action:"ADMIN.SYSTEM_EVENT_RESOLVED",entityType:"SystemEvent",entityId:id,summary:`System event ${event.code} resolved`,request},tx)});return NextResponse.json({ok:true})}
