param([string]$Marker)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$original=$null
for($attempt=0;$attempt -lt 10;$attempt++){
 try{$original=[Windows.Forms.Clipboard]::GetDataObject();break}
 catch{if($attempt -eq 9){throw};Start-Sleep -Milliseconds 100}
}
$backup=New-Object Windows.Forms.DataObject
if($null -ne $original){
 foreach($format in $original.GetFormats($false)){
  $value=$original.GetData($format,$false)
  if($value -is [Drawing.Bitmap]){$value=$value.Clone()}
  elseif($value -is [IO.MemoryStream]){$value=[IO.MemoryStream]::new($value.ToArray())}
  elseif($value -is [Array]){$value=$value.Clone()}
  if($null -ne $value){$backup.SetData($format,$false,$value)}
 }
}
[Console]::WriteLine('READY')
try{[void][Console]::ReadLine()}finally{
 if([Windows.Forms.Clipboard]::ContainsText() -and [Windows.Forms.Clipboard]::GetText().Contains($Marker)){
  [Windows.Forms.Clipboard]::SetDataObject($backup,$true)
 }
 [Console]::WriteLine('RESTORED')
}
