import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface ServerStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class ServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ServerStackProps) {
    super(scope, id, props);
    const { vpc } = props;

    // Web servers' SG: HTTP from anywhere
    const webSg = new ec2.SecurityGroup(this, 'WebServerSg', {
      vpc,
      description: 'Web servers: port 80 from anywhere',
    });
    webSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from anywhere');

    // Same content as the CloudFormation lab (cfn-init), as plain user data
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'dnf install -y httpd',
      'TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")',
      'IID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)',
      'AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)',
      'cat > /var/www/html/index.html <<HTML',
      '<img src="https://s3.amazonaws.com/cloudformation-examples/cloudformation_graphic.png" alt="AWS CloudFormation Logo"/>',
      '<h1>Congratulations, you have successfully launched the AWS CDK sample.</h1>',
      '<p>Served by instance $IID in $AZ</p>',
      'HTML',
      'systemctl enable --now httpd',
    );

    // One web server in each public subnet
    const webServers = vpc.publicSubnets.map(
      (subnet, i) =>
        new ec2.Instance(this, `WebServer${i + 1}`, {
          vpc,
          vpcSubnets: { subnets: [subnet] },
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
          machineImage: ec2.MachineImage.latestAmazonLinux2023(),
          securityGroup: webSg,
          associatePublicIpAddress: true,
          userData,
        }),
    );

    // RDS security group: MySQL only from the web servers' SG
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'RDS MySQL: 3306 from web server SG only',
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(webSg, ec2.Port.tcp(3306), 'MySQL from web servers');

    // RDS MySQL; subnet group = all private subnets
    const db = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      allocatedStorage: 20,
      multiAz: false,
      storageEncrypted: true,
      publiclyAccessible: false,
      credentials: rds.Credentials.fromGeneratedSecret('admin'),
      deletionProtection: false,
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Load balancer across both web servers
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB: port 80 from anywhere',
      allowAllOutbound: true, // CDK would otherwise omit the ALB -> web server egress rule
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from anywhere');
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      securityGroup: albSg,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    const listener = alb.addListener('Http', { port: 80 });
    listener.addTargets('WebTargets', {
      port: 80,
      targets: webServers.map((s) => new targets.InstanceTarget(s)),
      healthCheck: { path: '/', healthyHttpCodes: '200' },
    });

    new cdk.CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });
    webServers.forEach((s, i) =>
      new cdk.CfnOutput(this, `WebServer${i + 1}PublicIp`, { value: s.instancePublicIp }),
    );
    new cdk.CfnOutput(this, 'DbEndpoint', { value: db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: db.secret!.secretArn });
  }
}
