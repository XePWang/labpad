const encoder=new TextEncoder();
export class TerminalHistory {
 entries:string[]=[];cursor=-1;private bytes=0;
 constructor(public maxBytes=65536){}
 get sizeBytes(){return this.bytes;}
 setLimit(value:number){this.maxBytes=value;while(this.bytes>value&&this.entries.length)this.bytes-=encoder.encode(this.entries.pop()!).byteLength;this.resetCursor();}
 clear(){this.entries=[];this.bytes=0;this.resetCursor();}
 append(text:string){this.resetCursor();if(!text)return;const size=encoder.encode(text).byteLength;if(size>this.maxBytes){this.clear();return;}this.entries.unshift(text);this.bytes+=size;while(this.bytes>this.maxBytes)this.bytes-=encoder.encode(this.entries.pop()!).byteLength;}
 resetCursor(){this.cursor=-1;}
 next(){if(this.cursor>=0)this.cursor--;return this.entries[this.cursor];}
 prev(){if(this.cursor+1<this.entries.length)this.cursor++;return this.entries[this.cursor];}
}
