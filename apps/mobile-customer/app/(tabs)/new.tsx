import { Redirect } from 'expo-router';
// The center tab only opens the new-order flow (tabPress is intercepted in the layout).
export default function NewTab() { return <Redirect href="/new-order" />; }
