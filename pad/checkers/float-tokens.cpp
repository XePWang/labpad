// LabPad, MIT. Uses testlib (see vendor/testlib/LICENSE).
#include "testlib.h"
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <cctype>
#include <string>

bool decimalToken(const std::string& s) {
    size_t i=0, digits=0;
    if (i<s.size() && (s[i]=='+' || s[i]=='-')) ++i;
    while (i<s.size() && s[i]>='0' && s[i]<='9') { ++i; ++digits; }
    if (i<s.size() && s[i]=='.') {
        ++i;
        while (i<s.size() && s[i]>='0' && s[i]<='9') { ++i; ++digits; }
    }
    if (!digits) return false;
    if (i<s.size() && (s[i]=='e' || s[i]=='E')) {
        ++i;
        if (i<s.size() && (s[i]=='+' || s[i]=='-')) ++i;
        size_t before=i;
        while (i<s.size() && s[i]>='0' && s[i]<='9') ++i;
        if (i==before) return false;
    }
    return i==s.size();
}
bool finiteNumber(const std::string& s, long double& number) {
    if (!decimalToken(s)) return false;
    errno=0; char* end=nullptr;
    number=std::strtold(s.c_str(), &end);
    return errno!=ERANGE && end==s.c_str()+s.size() && std::isfinite(number)
        && std::isfinite(static_cast<double>(number));
}
bool specialNumber(std::string s) {
    for (char& c:s) c=static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (!s.empty() && (s[0]=='+' || s[0]=='-')) s.erase(0,1);
    return s=="nan" || s=="inf" || s=="infinity";
}
int main(int argc, char** argv) {
    if (argc!=6) return 3;
    std::string absOption=argv[4], relOption=argv[5];
    setName("LabPad numeric tokens: absolute OR relative tolerance");
    registerTestlibCmd(4,argv);
    long double absolute=0, relative=0;
    bool useAbs=absOption!="-", useRel=relOption!="-";
    if ((!useAbs && !useRel) || (useAbs && (!finiteNumber(absOption,absolute)||absolute<0))
        || (useRel && (!finiteNumber(relOption,relative)||relative<0))) quitf(_fail,"Invalid tolerances");
    int index=0;
    while (!ans.seekEof() && !ouf.seekEof()) {
        ++index;
        std::string expected=ans.readWord(), actual=ouf.readWord();
        long double e=0, a=0;
        bool en=finiteNumber(expected,e), an=finiteNumber(actual,a);
        if ((decimalToken(expected)&&!en) || specialNumber(expected)) quitf(_fail,"Invalid expected number at token %d",index);
        if ((decimalToken(actual)&&!an) || specialNumber(actual)) quitf(_wa,"Invalid output number at token %d",index);
        if (en && an) {
            long double difference=std::fabs(a-e);
            bool absoluteOK=useAbs && difference<=absolute;
            long double relativeError=e==0 ? (a==0?0:INFINITY) :
                (std::isfinite(difference)?difference/std::fabs(e):std::fabs(a/e-1));
            bool relativeOK=useRel && relativeError<=relative;
            if (!absoluteOK && !relativeOK) quitf(_wa,"Token %d differs: expected '%s', found '%s'",index,expected.c_str(),actual.c_str());
        } else if (expected!=actual) quitf(_wa,"Token %d differs: expected '%s', found '%s'",index,expected.c_str(),actual.c_str());
    }
    if (!ans.seekEof()) quitf(_wa,"Unexpected end of output");
    if (!ouf.seekEof()) quitf(_wa,"Output contains extra tokens");
    quitf(_ok,"%d tokens",index);
}
