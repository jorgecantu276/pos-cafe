'use client';

import {useEffect,useState} from 'react';

export function useDebouncedValue<T>(value:T,delay=300,onSettled?:(value:T)=>void){
  const [settled,setSettled]=useState(value);
  useEffect(()=>{
    if(Object.is(value,settled))return;
    const timer=setTimeout(()=>{setSettled(value);onSettled?.(value);},value===''?0:delay);
    return()=>clearTimeout(timer);
  },[value,settled,delay,onSettled]);
  return settled;
}
