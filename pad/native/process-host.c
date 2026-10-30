// LabPad process-tree host for Windows, MIT.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
#include <stdlib.h>
static wchar_t* quote(wchar_t* out, const wchar_t* arg) {
    *out++=L'"';
    while (*arg) {
        unsigned int slashes=0;
        while (*arg==L'\\') { ++slashes; ++arg; }
        if (*arg==L'"' || *arg==0) {
            for (unsigned int i=0;i<slashes*2;i++) *out++=L'\\';
            if (*arg==L'"') { *out++=L'\\'; *out++=*arg++; }
        } else {
            for (unsigned int i=0;i<slashes;i++) *out++=L'\\';
            *out++=*arg++;
        }
    }
    *out++=L'"'; return out;
}
int wmain(int argc, wchar_t** argv) {
    int terminal=argc>1 && wcscmp(argv[1],L"--terminal")==0;
    int first=terminal?2:1;
    if (argc<=first) return 125;
    if(terminal && (!SetConsoleCP(CP_UTF8) || !SetConsoleOutputCP(CP_UTF8))) return 125;
    size_t size=1;
    for (int i=first;i<argc;i++) size+=wcslen(argv[i])*2+4;
    wchar_t* command=(wchar_t*)calloc(size,sizeof(wchar_t));
    if(!command) return 125;
    wchar_t* end=command;
    for(int i=first;i<argc;i++) { if(i>first)*end++=L' '; end=quote(end,argv[i]); }
    *end=0;
    HANDLE job=CreateJobObjectW(NULL,NULL);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={0};
    limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if(!job || !SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits))) return 125;
    STARTUPINFOW start={0}; start.cb=sizeof(start);
    start.dwFlags=STARTF_USESTDHANDLES;
    start.hStdInput=GetStdHandle(STD_INPUT_HANDLE);
    start.hStdOutput=GetStdHandle(STD_OUTPUT_HANDLE);
    start.hStdError=GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION process={0};
    if(!CreateProcessW(NULL,command,NULL,NULL,TRUE,CREATE_SUSPENDED|(terminal?0:CREATE_NO_WINDOW),NULL,NULL,&start,&process)) {
        fwprintf(stderr,L"LabPad process host: CreateProcess failed: %lu\n",GetLastError());CloseHandle(job);free(command);return 125;
    }
    free(command);
    if(!AssignProcessToJobObject(job,process.hProcess)){
        fwprintf(stderr,L"LabPad process host: AssignProcessToJobObject failed: %lu\n",GetLastError());
        TerminateProcess(process.hProcess,125);CloseHandle(process.hThread);CloseHandle(process.hProcess);CloseHandle(job);return 125;
    }
    ResumeThread(process.hThread);CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess,INFINITE);
    DWORD code=125;GetExitCodeProcess(process.hProcess,&code);
    CloseHandle(process.hProcess);CloseHandle(job);
    return (int)code;
}
