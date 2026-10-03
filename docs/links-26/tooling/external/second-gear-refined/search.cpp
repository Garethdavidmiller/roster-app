#include <bits/stdc++.h>
using namespace std;
struct M {int rest=100000,run=0,worst=0,early=0,earlybad=0,jumps=0,back=0,forward=0,rolling=0,between=0,weekends=0,gap=26,one=0,mixed=0,iso=0,peak=0,allpeak=0;double step=0,penalty=0,quality=0;};
vector<string> names={"RD","SP"};vector<int> st={-1,-2},en={-1,-2};vector<int> active;
int leavecost(const array<int,182>&a,int start,int length){int cost=0,last=-1,c=0;for(int t=start;t<start+length;t++){if(t/7!=last){cost+=min(4,c);c=0;last=t/7;}if(t%7==0)continue;int v=a[t%182];if(v==1)c++;else if(v>=2)cost++;}return cost+min(4,c);}
M calc(const array<int,182>& a){
 M m;int workrun=0,earlyrun=0,between=0; vector<int>wends;double means[26];int steps=0;
 for(int i=0;i<364;i++){int k=i%182, v=a[k];if(v>=2){workrun++;between++;}else workrun=0;
 m.run=max(m.run,workrun);
 if(v>=2&&st[v]<420)earlyrun++;else earlyrun=0;m.early=max(m.early,earlyrun);
 if(v<2&&a[(k+181)%182]<2)between=0;m.between=max(m.between,between);
 if(i>=182)continue;
 if(v==0&&a[(k+181)%182]>=2&&a[(k+1)%182]>=2)m.iso++;
 if(v>=2){int next=(k+1)%182;if(a[next]>=2){int diff=st[a[next]]-st[v];m.jumps+=abs(diff)>120;m.back+=diff<0;m.forward+=diff>0;}
 int j=1;while(j<182&&a[(k+j)%182]<2)j++;m.rest=min(m.rest,j*1440+st[a[(k+j)%182]]-en[v]);
 if(st[v]<420&&a[(k+181)%182]>=2&&st[a[(k+181)%182]]<420&&(a[next]<2||st[a[next]]>=420)){
  if(a[next]!=1 && (a[next]>=2 || a[(k+2)%182]>=2))m.earlybad++;
 }
 }
 int sum=0;for(int j=0;j<7;j++){int t=a[(k+j)%182];if(t>=2)sum+=en[t]-st[t];}m.rolling=max(m.rolling,sum);
 }
 m.worst=m.run;
 for(int r=0;r<26;r++){
  int sum=0,all=0,count=0,early=0,late=0,ss=0;set<int> ts;
  for(int d=0;d<7;d++){int v=a[r*7+d];if(v>=2){all+=en[v]-st[v];ss+=st[v];count++;early+=st[v]<660;late+=st[v]>=660;if(d)sum+=en[v]-st[v];if(d>0&&d<6)ts.insert(v);}}
  m.peak=max(m.peak,sum);m.allpeak=max(m.allpeak,all);m.mixed+=(early&&late);m.one+=(ts.size()==1&&!(early&&late));means[r]=count?double(ss)/count:-1;
  if(a[r*7+6]==0&&a[((r+1)%26)*7]==0)wends.push_back(r);
  if(a[r*7]==1){int l=0,rr=0;for(int j=1;j<=10&&a[(r*7-j+182)%182]>=2;j++)l++;for(int j=0;j<10&&a[(r*7+7+j)%182]>=2;j++)rr++;m.worst=max(m.worst,4+max(l,rr));}
 }
 m.weekends=wends.size();if(m.weekends){m.gap=0;for(int j=0;j<m.weekends;j++)m.gap=max(m.gap,(wends[(j+1)%m.weekends]-wends[j]+26)%26);}
 for(int r=0;r<26;r++)if(means[r]>=0&&means[(r+1)%26]>=0){m.step+=abs(means[r]-means[(r+1)%26]);steps++;}m.step/=max(1,steps);
 auto over=[](double x,double lim){return max(0.0,x-lim);};
 m.penalty=over(875,m.rest)*5+over(m.run,5)*150+over(m.worst,6)*150+over(m.early,4)*150+m.earlybad*150+m.jumps*150+over(m.back,m.forward)*60+over(m.rolling,2970)+over(m.between,13)*100+over(7,m.weekends)*250+over(m.gap,5)*150+over(16,m.one)*100+over(m.mixed,2)*100+over(m.iso,4)*100+over(m.peak,2490)*2+over(m.allpeak,2580)*2+over(m.step,85.375)*3;
 if(m.penalty<1e-6){int worst=0,best=99,four=99;for(int t=0;t<182;t++){worst=max(worst,leavecost(a,t,20));best=min(best,leavecost(a,t,28));if(t%7==0)four=min(four,leavecost(a,t,28));}m.penalty+=over(worst,14)*150+over(best,14)*100+over(four,15)*100;}
 m.quality=m.mixed*55+m.iso*55+m.step*.8+m.peak*.015+m.allpeak*.01;
 return m;
}
void report(M m){cerr<<" penalty="<<m.penalty<<" quality="<<m.quality<<" mixed="<<m.mixed<<" iso="<<m.iso<<" one="<<m.one<<" step="<<m.step<<" peak="<<m.peak<<" allpeak="<<m.allpeak<<" rest="<<m.rest<<" run="<<m.run<<" worst="<<m.worst<<" weekends="<<m.weekends<<" gap="<<m.gap<<" earlybad="<<m.earlybad<<" jumps="<<m.jumps<<" back/forward="<<m.back<<"/"<<m.forward<<" rolling="<<m.rolling<<"\n";}
void save(const array<int,182>&a,string fn){ofstream o(fn);for(int r=0;r<26;r++){o<<r+1;for(int d=0;d<7;d++)o<<'\t'<<names[a[r*7+d]];o<<'\n';}}
int main(int argc,char**argv){ifstream f(argv[1]);array<int,182>base;string line;int r=0;while(getline(f,line)){stringstream s(line);int n;s>>n;string t;for(int d=0;d<7;d++){s>>t;auto it=find(names.begin(),names.end(),t);int id=it-names.begin();if(it==names.end()){names.push_back(t);st.push_back(stoi(t.substr(0,2))*60+stoi(t.substr(3,2)));en.push_back(stoi(t.substr(6,2))*60+stoi(t.substr(9,2)));}base[r*7+d]=id;}if(base[r*7]!=1)active.push_back(r);r++;}
 auto bm=calc(base);cerr<<"BASE";report(bm);array<int,182>best=base;double bestq=bm.quality;mt19937 rng(47288);auto start=chrono::steady_clock::now();int limit=argc>2?atoi(argv[2]):100;
 for(int trial=0;chrono::duration<double>(chrono::steady_clock::now()-start).count()<limit;trial++){
 auto a=(trial%3==0?base:best);M m=calc(a);double score=m.quality+10*m.penalty;
 for(int it=0;it<180000;it++){
  int x=active[rng()%active.size()],y=active[rng()%active.size()];if(x==y)continue;int d=rng()%7,mode=rng()%100;int mask=mode<80?(1<<d):mode<95?127:((1<<d)|(1<<((d+1)%7)));
  bool changed=false;for(int j=0;j<7;j++)if(mask>>j&1){changed|=a[x*7+j]!=a[y*7+j];swap(a[x*7+j],a[y*7+j]);}if(!changed)continue;
  M nm=calc(a);double ns=nm.quality+10*nm.penalty;double t= max(.05,80.0*pow(0.001,double(it)/180000));
  if(ns<=score||generate_canonical<double,32>(rng)<exp((score-ns)/t)){score=ns;m=nm;}else{for(int j=0;j<7;j++)if(mask>>j&1)swap(a[x*7+j],a[y*7+j]);}
  if(m.penalty<1e-6&&m.quality<bestq-1e-6){best=a;bestq=m.quality;cerr<<"BEST "<<trial<<":"<<it;report(m);save(best,"roster-search/candidate.txt");}
  if(it%20000==0&&chrono::duration<double>(chrono::steady_clock::now()-start).count()>limit)break;
 }
 }
 cerr<<"FINAL";report(calc(best));save(best,"roster-search/candidate.txt");
}
