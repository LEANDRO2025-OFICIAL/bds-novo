' Roda SERVIDOR-PUBLICADO.cmd sem abrir janela (usado pela tarefa agendada "Banco de Precos LS").
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & pasta & "\SERVIDOR-PUBLICADO.cmd""", 0, False
