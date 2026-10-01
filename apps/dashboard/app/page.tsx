'use client';
import { useStaff } from './providers';
import { Login } from '@mashawir/dashboard-ui';
import { DashboardShell } from './shell';
export default function Page(){const{staff,loading,login,request}=useStaff();if(loading)return <div className="loading">جارٍ التحميل...</div>;return staff?<DashboardShell/>:<Login login={login} request={request}/>;}
