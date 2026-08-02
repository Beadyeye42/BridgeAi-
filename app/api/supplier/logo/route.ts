import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { getPrivateStorage, PRIVATE_BUCKET } from "@/lib/storage";
export async function GET(){const auth=await requireSupplierApi();if("error"in auth)return auth.error;const company=await prisma.supplierCompany.findUnique({where:{id:auth.companyId},select:{logoUrl:true}});if(!company?.logoUrl)return new NextResponse(null,{status:404});const attachment=await prisma.attachment.findUnique({where:{storageKey:company.logoUrl}});if(!attachment||attachment.scanStatus!=="CLEAN")return new NextResponse(null,{status:423});const signed=await (await getPrivateStorage()).storage.from(PRIVATE_BUCKET).createSignedUrl(company.logoUrl,300);if(signed.error)return new NextResponse(null,{status:503});return NextResponse.redirect(signed.data.signedUrl)}
