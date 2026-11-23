# CDK Website on EC2

Two CDK (TypeScript) stacks, rebuilt from the CloudFormation lab:

- **NetworkStack** – VPC with 1 public + 1 private subnet in each of 2 AZs (no NAT gateway).
- **ServerStack**
  - 1 Amazon Linux 2023 web server (Apache, user data) per public subnet
  - Web SG: port 80 from anywhere
  - RDS MySQL in a subnet group of both private subnets; DB SG: port 3306 only from the web SG
  - Internet-facing Application Load Balancer distributing HTTP across both web servers

## Deploy
```
export AWS_REGION=us-east-1 CDK_DEFAULT_REGION=us-east-1 CDK_DEFAULT_ACCOUNT=<account-id>
npm install
npx cdk bootstrap
npx cdk deploy --all
```
Outputs include the ALB DNS name, web server public IPs, DB endpoint and secret ARN.

## Clean up
```
npx cdk destroy --all
```
