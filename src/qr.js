// QR encoder (version 5, level L, byte mode, up to 106 bytes).
// Standalone QR encoder for version 5, error-correction level L, byte-mode messages.
// Supports up to 106 UTF-8 bytes, sufficient for typical local and hosted join URLs.
// No external services or runtime dependencies: QR payload never leaves the server.
const SIZE=37, DATA_CODEWORDS=108, ECC_CODEWORDS=26;
function gfMul(a,b){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((b>>>i)&1)*a;}return z;}
function eccDivisor(degree){const d=Array(degree).fill(0);d[degree-1]=1;let root=1;for(let i=0;i<degree;i++){for(let j=0;j<degree;j++){d[j]=gfMul(d[j],root);if(j+1<degree)d[j]^=d[j+1];}root=gfMul(root,0x02);}return d;}
function eccRemainder(data,div){let result=Array(div.length).fill(0);for(const b of data){let factor=b^result.shift();result.push(0);for(let i=0;i<div.length;i++)result[i]^=gfMul(div[i],factor);}return result;}
function matrix(value){
 const bytes=Array.from(new TextEncoder().encode(value));if(bytes.length>106)throw Error('Join link exceeds embedded QR capacity');
 const bits=[];function append(val,n){for(let i=n-1;i>=0;i--)bits.push((val>>>i)&1);}
 append(0b0100,4);append(bytes.length,8);for(const b of bytes)append(b,8);
 for(let i=0;i<Math.min(4,DATA_CODEWORDS*8-bits.length);i++)bits.push(0);
 while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bits[i+j];data.push(b);}
 while(data.length<DATA_CODEWORDS)data.push(data.length%2?0x11:0xEC);
 const codewords=[...data,...eccRemainder(data,eccDivisor(ECC_CODEWORDS))];
 const mods=Array.from({length:SIZE},()=>Array(SIZE).fill(false));
 const funcs=Array.from({length:SIZE},()=>Array(SIZE).fill(false));
 const put=(x,y,dark)=>{if(x>=0&&y>=0&&x<SIZE&&y<SIZE){mods[y][x]=dark;funcs[y][x]=true;}};
 // Timing patterns, finder targets with white separators, alignment pattern, dark module.
 for(let i=0;i<SIZE;i++){put(6,i,i%2===0);put(i,6,i%2===0);}
 for(const [cx,cy] of [[3,3],[SIZE-4,3],[3,SIZE-4]]){
   for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
     let d=Math.max(Math.abs(dx),Math.abs(dy));put(cx+dx,cy+dy,d!==2&&d!==4);
   }
 }
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){let d=Math.max(Math.abs(dx),Math.abs(dy));put(30+dx,30+dy,d===2||d===0);}
 for(let i=0;i<=8;i++){if(i!==6){put(8,i,false);put(i,8,false);}}
 for(let i=0;i<8;i++){put(SIZE-1-i,8,false);put(8,SIZE-1-i,false);}
 put(8,SIZE-8,true);
 // Fill remaining data cells in the QR-standard two-column zig-zag order.
 let bitIndex=0;
 for(let right=SIZE-1;right>=1;right-=2){if(right===6)right=5;
  for(let vert=0;vert<SIZE;vert++)for(let j=0;j<2;j++){
   let x=right-j,y=(((right+1)&2)===0)?SIZE-1-vert:vert;
   if(!funcs[y][x]){
     let v=bitIndex<codewords.length*8?((codewords[bitIndex>>>3]>>>(7-(bitIndex&7)))&1):0;
     if((x+y)%2===0)v^=1; // QR mask 0.
     mods[y][x]=!!v;bitIndex++;
   }
  }
 }
 // EC level L has format bits 01, and we use data mask 0.
 let formatData=(1<<3)|0,rem=formatData;
 for(let i=0;i<10;i++)rem=(rem<<1)^(((rem>>>9)&1)*0x537);
 let format=((formatData<<10)|rem)^0x5412;
 let fb=i=>((format>>>i)&1)!==0;
 for(let i=0;i<=5;i++)put(8,i,fb(i));put(8,7,fb(6));put(8,8,fb(7));put(7,8,fb(8));
 for(let i=9;i<15;i++)put(14-i,8,fb(i));
 for(let i=0;i<8;i++)put(SIZE-1-i,8,fb(i));
 for(let i=8;i<15;i++)put(8,SIZE-15+i,fb(i));
 put(8,SIZE-8,true);
 return mods;
}
function svg(value){const m=matrix(value),quiet=4,scale=6,sz=(SIZE+quiet*2)*scale;
 let cells='';for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)if(m[y][x])cells+=`<rect x="${(x+quiet)*scale}" y="${(y+quiet)*scale}" width="${scale}" height="${scale}"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><rect width="100%" height="100%" fill="white"/><g fill="#102239">${cells}</g></svg>`;
}
export { matrix, svg };

