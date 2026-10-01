import {NextResponse} from 'next/server';export async function POST(){const r=NextResponse.json({ok:true});r.cookies.delete('msh_at');r.cookies.delete('msh_rt');return r}
