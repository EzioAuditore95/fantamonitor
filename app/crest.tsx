'use client';
import { initials } from '@/lib/model';
import { teamColor,type LeagueConfig } from '@/lib/league';

// Shared by the dashboard and the Home tab. The colour is a league parameter with a
// name-derived fallback, so a league with no palette still shows something legible.
export default function Crest({cfg,name,url}:{cfg:LeagueConfig;name:string;url?:string}){
  return <span className="crest" style={{backgroundColor:teamColor(cfg,name),overflow:'hidden'}} aria-hidden="true">{url?<img src={url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:initials(name)}</span>;
}
