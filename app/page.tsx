import Register from './register/Register';
export const dynamic='force-dynamic';
export default function POSPage(){return <Register appearance={process.env.POS_REGISTER_UI==='owner'?'owner':process.env.POS_REGISTER_UI==='prototype'?'prototype':'workspace'}/>;}
